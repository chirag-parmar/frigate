from typing import List, Optional

from pydantic import Field

from .base import FrigateBaseModel

__all__ = ["DashboardPanelConfig", "DashboardConfig"]


class DashboardPanelConfig(FrigateBaseModel):
    title: str = Field(
        title="Panel title",
        description="Display title shown above the occupancy graph for this panel.",
    )
    cameras: Optional[List[str]] = Field(
        default=None,
        title="Cameras",
        description="List of camera names whose person detections are combined into this panel. Mutually exclusive with zones.",
    )
    zones: Optional[List[str]] = Field(
        default=None,
        title="Zones",
        description="List of zone names (across all cameras) whose person detections are combined into this panel. Mutually exclusive with cameras.",
    )


class DashboardConfig(FrigateBaseModel):
    panels: Optional[List[DashboardPanelConfig]] = Field(
        default=None,
        title="Dashboard panels",
        description="Ordered list of occupancy graph panels. When omitted, one panel per detection-enabled camera is generated automatically.",
    )
