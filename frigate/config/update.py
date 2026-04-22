from pydantic import Field

from .base import FrigateBaseModel

__all__ = ["UpdateConfig"]


class UpdateConfig(FrigateBaseModel):
    enabled: bool = Field(
        default=False,
        title="OTA updates enabled",
        description="Enable OTA update management. Requires /var/run/docker.sock mounted into the container.",
    )
    registry: str = Field(
        default="ghcr.io/your-org/frigate",
        title="Docker registry image",
        description="Full image path on a Docker registry, e.g. ghcr.io/my-org/frigate. Registry tokens are provided per-request via the UI and are never stored.",
    )
