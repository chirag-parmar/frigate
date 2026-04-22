import { useCallback, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import useSWR from "swr";
import { LuEye, LuEyeOff, LuRefreshCw } from "react-icons/lu";
import { MdCircle } from "react-icons/md";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import Heading from "@/components/ui/heading";
import { FrigateConfig } from "@/types/frigateConfig";
import type {
  RegistryVersion,
  UpdateHistoryEntry,
  VersionsResponse,
} from "@/types/update";

export default function UpdateManagerView() {
  const { data: config, mutate: mutateConfig } = useSWR<FrigateConfig>(
    "config",
    { revalidateOnFocus: false },
  );

  // ----- Registry config form state -----
  const [enabled, setEnabled] = useState<boolean>(
    config?.update?.enabled ?? false,
  );
  const [registry, setRegistry] = useState<string>(
    config?.update?.registry ?? "ghcr.io/your-org/frigate",
  );
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // ----- Token & version state -----
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [versions, setVersions] = useState<VersionsResponse | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  // ----- History -----
  const { data: history, mutate: mutateHistory } =
    useSWR<UpdateHistoryEntry[]>("update/history");

  // ----- Confirmation dialog -----
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  // ---- Save registry config ----
  const handleSaveConfig = useCallback(async () => {
    setIsSavingConfig(true);
    try {
      await axios.put("config/set", {
        requires_restart: 1,
        config_data: { update: { enabled, registry } },
      });
      await mutateConfig();
      toast.success("Update config saved. Restart required for changes to take effect.");
    } catch {
      toast.error("Failed to save update config.");
    } finally {
      setIsSavingConfig(false);
    }
  }, [enabled, registry, mutateConfig]);

  // ---- Load versions from registry ----
  const handleLoadVersions = useCallback(async () => {
    setIsLoadingVersions(true);
    try {
      const resp = await axios.post<VersionsResponse>("update/versions", {
        token: token || null,
      });
      setVersions(resp.data);
    } catch (err: unknown) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.message
          ? err.response.data.message
          : "Failed to fetch versions from registry.";
      toast.error(msg);
      setVersions(null);
    } finally {
      setIsLoadingVersions(false);
    }
  }, [token]);

  // ---- Apply / rollback ----
  const handleApply = useCallback(async () => {
    if (!pendingVersion) return;
    setIsApplying(true);
    setPendingVersion(null);
    try {
      const resp = await axios.post("update/apply", {
        version: pendingVersion,
        token: token || null,
      });
      toast.success(resp.data.message ?? `Update to ${pendingVersion} initiated.`);
      await mutateHistory();
    } catch (err: unknown) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.message
          ? err.response.data.message
          : "Update failed. Check logs for details.";
      toast.error(msg);
      await mutateHistory();
    } finally {
      setIsApplying(false);
    }
  }, [pendingVersion, token, mutateHistory]);

  const statusColor: Record<UpdateHistoryEntry["status"], string> = {
    active: "text-success",
    downloading: "text-orange-400",
    rolled_back: "text-muted-foreground",
    failed: "text-danger",
  };

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* ---- Registry Configuration ---- */}
      <div className="flex flex-col gap-3">
        <Heading as="h4">Registry Configuration</Heading>

        <div className="flex items-center gap-3">
          <Switch
            id="update-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor="update-enabled">Enable OTA updates</Label>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="update-registry">Registry image</Label>
          <Input
            id="update-registry"
            className="w-full max-w-md"
            placeholder="ghcr.io/your-org/frigate"
            value={registry}
            onChange={(e) => setRegistry(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Full image path, e.g. <code>ghcr.io/my-org/frigate</code>
          </p>
        </div>

        <Button
          className="w-fit"
          disabled={isSavingConfig}
          onClick={handleSaveConfig}
        >
          {isSavingConfig ? <ActivityIndicator className="mr-2 size-4" /> : null}
          Save configuration
        </Button>
      </div>

      {/* ---- Token & Load Versions ---- */}
      <div className="flex flex-col gap-3">
        <Heading as="h4">Available Versions</Heading>
        <p className="text-sm text-muted-foreground">
          Enter a registry token if the image is private. The token is used
          once per request and is never stored.
        </p>

        <div className="flex flex-col gap-1">
          <Label htmlFor="update-token">Registry token (optional)</Label>
          <div className="relative flex w-full max-w-md items-center">
            <Input
              id="update-token"
              type={showToken ? "text" : "password"}
              className="pr-10"
              placeholder="ghp_xxxxxxxxxxxx"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              type="button"
              className="absolute right-3 text-muted-foreground hover:text-foreground"
              onClick={() => setShowToken((v) => !v)}
              tabIndex={-1}
            >
              {showToken ? (
                <LuEyeOff className="size-4" />
              ) : (
                <LuEye className="size-4" />
              )}
            </button>
          </div>
        </div>

        <Button
          variant="outline"
          className="w-fit gap-2"
          disabled={isLoadingVersions || !enabled}
          onClick={handleLoadVersions}
        >
          {isLoadingVersions ? (
            <ActivityIndicator className="size-4" />
          ) : (
            <LuRefreshCw className="size-4" />
          )}
          Load versions
        </Button>

        {!enabled && (
          <p className="text-xs text-orange-400">
            Enable OTA updates and save the configuration before loading versions.
          </p>
        )}

        {versions && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Current:{" "}
                <strong className="text-foreground">
                  {versions.current_version}
                </strong>
              </span>
              <span>·</span>
              <span>
                Latest:{" "}
                <strong className="text-foreground">
                  {versions.latest_version}
                </strong>
              </span>
            </div>

            <div className="flex flex-col divide-y divide-secondary-highlight rounded-lg border border-secondary-highlight">
              {versions.versions.map((v: RegistryVersion) => (
                <div
                  key={v.tag}
                  className="flex items-center justify-between px-4 py-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <MdCircle
                      className={`size-2 shrink-0 ${
                        v.is_current
                          ? "text-success"
                          : v.is_latest
                            ? "text-orange-400"
                            : "text-muted-foreground"
                      }`}
                    />
                    <span className="font-mono">{v.tag}</span>
                    {v.is_current && (
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs text-success">
                        current
                      </span>
                    )}
                    {v.is_latest && !v.is_current && (
                      <span className="rounded bg-orange-400/10 px-1.5 py-0.5 text-xs text-orange-400">
                        latest
                      </span>
                    )}
                  </div>

                  {!v.is_current && (
                    <Button
                      size="sm"
                      variant={v.is_latest ? "default" : "outline"}
                      disabled={isApplying}
                      onClick={() => setPendingVersion(v.tag)}
                    >
                      {v.is_latest ? "Update" : "Rollback"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ---- Update History ---- */}
      {history && history.length > 0 && (
        <div className="flex flex-col gap-3">
          <Heading as="h4">Update History</Heading>
          <div className="flex flex-col divide-y divide-secondary-highlight rounded-lg border border-secondary-highlight">
            {history.map((entry: UpdateHistoryEntry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between px-4 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <MdCircle
                    className={`size-2 shrink-0 ${statusColor[entry.status]}`}
                  />
                  <span className="font-mono">{entry.version}</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>
                    {new Date(entry.applied_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span
                    className={`capitalize ${statusColor[entry.status]}`}
                  >
                    {entry.status.replace("_", " ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Confirmation dialog ---- */}
      <AlertDialog
        open={pendingVersion !== null}
        onOpenChange={(open) => {
          if (!open) setPendingVersion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply update?</AlertDialogTitle>
            <AlertDialogDescription>
              This will pull image version{" "}
              <strong>{pendingVersion}</strong> and restart the Frigate
              container. The UI will be unavailable for a short time during
              restart. Proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApply}>
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
