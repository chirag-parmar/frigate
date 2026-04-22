"""OTA update API endpoints."""

import logging
import socket
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from frigate.api.auth import require_role
from frigate.api.defs.tags import Tags
from frigate.models import UpdateHistory
from frigate.stats.util import get_available_versions
from frigate.version import VERSION

logger = logging.getLogger(__name__)

router = APIRouter(tags=[Tags.app])


class VersionsRequest(BaseModel):
    token: Optional[str] = None


class ApplyUpdateRequest(BaseModel):
    version: str
    token: Optional[str] = None


def _get_docker_client():
    """Return a docker client if the socket is available, else None."""
    try:
        import docker  # type: ignore[import-untyped]

        client = docker.from_env()
        client.ping()
        return client
    except Exception:
        return None


def _get_current_container_id() -> Optional[str]:
    """Detect the running container's own ID from /proc/self/cgroup."""
    try:
        with open("/proc/self/cgroup") as f:
            for line in f:
                # cgroup v1: e.g. "12:devices:/docker/<64-char-id>"
                # cgroup v2: e.g. "0::/system.slice/docker-<64-char-id>.scope"
                parts = line.strip().split("/")
                for part in reversed(parts):
                    if len(part) == 64 and all(c in "0123456789abcdef" for c in part):
                        return part
                    if part.startswith("docker-") and part.endswith(".scope"):
                        cid = part[len("docker-") : -len(".scope")]
                        if len(cid) == 64:
                            return cid
    except Exception:
        pass
    # Fallback: Docker sets hostname to the short container ID by default
    return socket.gethostname() or None


@router.post(
    "/update/versions",
    dependencies=[Depends(require_role(["admin"]))],
    summary="List available versions from registry",
    description="Query the configured Docker registry for available image tags. Pass an ephemeral bearer token if the registry is private.",
)
def list_versions(body: VersionsRequest, request: Request):
    config = request.app.frigate_config
    if not config.update.enabled:
        return JSONResponse(
            content={"success": False, "message": "OTA updates are not enabled."},
            status_code=400,
        )

    versions = get_available_versions(config.update, token=body.token)
    if not versions:
        return JSONResponse(
            content={"success": False, "message": "Could not retrieve versions from registry. Check registry URL and token."},
            status_code=502,
        )

    current = VERSION.split("-")[0]  # strip commit hash suffix
    latest = versions[0] if versions else current

    return JSONResponse(
        content={
            "current_version": current,
            "latest_version": latest,
            "versions": [
                {
                    "tag": v,
                    "is_current": v == current,
                    "is_latest": v == latest,
                }
                for v in versions
            ],
        }
    )


@router.post(
    "/update/apply",
    dependencies=[Depends(require_role(["admin"]))],
    summary="Pull and apply a version",
    description="Pull the specified image version from the registry and restart the container. Requires Docker socket mounted at /var/run/docker.sock.",
)
def apply_update(body: ApplyUpdateRequest, request: Request):
    config = request.app.frigate_config
    if not config.update.enabled:
        return JSONResponse(
            content={"success": False, "message": "OTA updates are not enabled."},
            status_code=400,
        )

    client = _get_docker_client()
    if client is None:
        return JSONResponse(
            content={
                "success": False,
                "message": "Docker socket not available. Mount /var/run/docker.sock into the container to enable OTA updates.",
            },
            status_code=503,
        )

    registry = config.update.registry
    target_image = f"{registry}:{body.version}"

    # Record update attempt
    history_entry = UpdateHistory.create(
        version=body.version,
        applied_at=datetime.utcnow(),
        status="downloading",
        image_id=None,
        notes=None,
    )

    try:
        # Pull the new image
        pull_kwargs: dict = {"tag": body.version}
        if body.token:
            pull_kwargs["auth_config"] = {"username": "token", "password": body.token}

        logger.info(f"Pulling image {target_image}")
        image = client.images.pull(registry, **pull_kwargs)
        image_id = image.id if image else None

        history_entry.image_id = image_id
        history_entry.save()

        # Mark previous active entries as rolled_back if this is a newer version
        (
            UpdateHistory.update(status="rolled_back")
            .where(
                UpdateHistory.id != history_entry.id,
                UpdateHistory.status == "active",
            )
            .execute()
        )

        history_entry.status = "active"
        history_entry.save()

    except Exception as e:
        logger.error(f"Failed to pull image {target_image}: {e}")
        history_entry.status = "failed"
        history_entry.notes = str(e)
        history_entry.save()
        return JSONResponse(
            content={"success": False, "message": f"Failed to pull image: {e}"},
            status_code=500,
        )

    # Restart the container with the new image using a detached helper
    try:
        container_id = _get_current_container_id()
        if container_id:
            current_container = client.containers.get(container_id)
            run_config = current_container.attrs

            # Launch a transient alpine helper that stops/removes the current
            # container and starts a new one with the pulled image.
            # The helper exits once done; the new container takes over.
            host_config = run_config.get("HostConfig", {})
            env = run_config.get("Config", {}).get("Env", [])
            volumes = host_config.get("Binds", [])
            ports = host_config.get("PortBindings", {})
            network_mode = host_config.get("NetworkMode", "bridge")
            container_name = run_config.get("Name", "").lstrip("/")
            restart_policy = host_config.get("RestartPolicy", {})

            # Create the new container first (don't start it yet)
            new_container = client.containers.create(
                target_image,
                environment=env,
                volumes=volumes if volumes else None,
                ports=ports if ports else None,
                network_mode=network_mode,
                name=f"{container_name}_ota" if container_name else None,
                restart_policy=restart_policy if restart_policy.get("Name") else None,
                detach=True,
            )

            # Run the helper that stops current and starts new
            client.containers.run(
                "alpine:latest",
                command=[
                    "sh",
                    "-c",
                    f"sleep 2 && docker stop {container_id[:12]} && docker rm {container_id[:12]} && docker start {new_container.id[:12]}",
                ],
                volumes={"/var/run/docker.sock": {"bind": "/var/run/docker.sock", "mode": "rw"}},
                remove=True,
                detach=True,
            )

            logger.info(f"OTA update to {body.version} initiated, container restart pending.")
            return JSONResponse(
                content={
                    "success": True,
                    "message": f"Image {target_image} pulled successfully. Container will restart momentarily.",
                    "version": body.version,
                }
            )
        else:
            logger.warning("Could not determine current container ID; image pulled but no restart initiated.")
            return JSONResponse(
                content={
                    "success": True,
                    "message": f"Image {target_image} pulled. Could not detect container ID — please restart the container manually.",
                    "version": body.version,
                }
            )

    except Exception as e:
        logger.error(f"Failed to initiate container restart: {e}")
        return JSONResponse(
            content={
                "success": True,
                "message": f"Image pulled but failed to initiate restart: {e}. Please restart the container manually.",
                "version": body.version,
            }
        )


@router.get(
    "/update/history",
    dependencies=[Depends(require_role(["admin"]))],
    summary="Get update history",
    description="Returns a list of all past update attempts ordered by most recent first.",
)
def get_update_history(request: Request):
    records = (
        UpdateHistory.select()
        .order_by(UpdateHistory.applied_at.desc())
        .dicts()
    )
    return JSONResponse(
        content=[
            {
                "id": r["id"],
                "version": r["version"],
                "applied_at": r["applied_at"].isoformat() if hasattr(r["applied_at"], "isoformat") else str(r["applied_at"]),
                "status": r["status"],
                "image_id": r["image_id"],
                "notes": r["notes"],
            }
            for r in records
        ]
    )
