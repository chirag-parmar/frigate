export type RegistryVersion = {
  tag: string;
  is_current: boolean;
  is_latest: boolean;
};

export type VersionsResponse = {
  current_version: string;
  latest_version: string;
  versions: RegistryVersion[];
};

export type UpdateHistoryEntry = {
  id: number;
  version: string;
  applied_at: string;
  status: "downloading" | "active" | "rolled_back" | "failed";
  image_id: string | null;
  notes: string | null;
};
