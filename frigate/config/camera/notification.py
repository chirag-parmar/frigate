from typing import Optional

from pydantic import Field

from ..base import FrigateBaseModel

__all__ = ["NotificationConfig", "NotificationScheduleConfig", "NotificationTimeSlot"]

VALID_DAY_NAMES = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


class NotificationTimeSlot(FrigateBaseModel):
    days: list[str] = Field(
        default=["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        title="Days",
        description="Days of the week for this time slot. Valid values: mon, tue, wed, thu, fri, sat, sun.",
    )
    start: str = Field(
        default="00:00",
        title="Start time",
        description="Start of this time slot in HH:MM (24-hour) format.",
        pattern=r"^\d{2}:\d{2}$",
    )
    end: str = Field(
        default="23:59",
        title="End time",
        description="End of this time slot in HH:MM (24-hour) format.",
        pattern=r"^\d{2}:\d{2}$",
    )


class NotificationScheduleConfig(FrigateBaseModel):
    timezone: str = Field(
        default="UTC",
        title="Timezone",
        description="IANA timezone name (e.g. America/New_York) used to interpret the time slots.",
    )
    slots: list[NotificationTimeSlot] = Field(
        default=[],
        title="Time slots",
        description="List of day/time windows when notifications are active. Notifications fire if the current time matches any slot. If empty, notifications fire at all times.",
    )


class NotificationConfig(FrigateBaseModel):
    enabled: bool = Field(
        default=False,
        title="Enable notifications",
        description="Enable or disable notifications for all cameras; can be overridden per-camera.",
    )
    email: Optional[str] = Field(
        default=None,
        title="Notification email",
        description="Email address used for push notifications or required by certain notification providers.",
    )
    cooldown: int = Field(
        default=0,
        ge=0,
        title="Cooldown period",
        description="Cooldown (seconds) between notifications to avoid spamming recipients.",
    )
    active_hours: Optional[NotificationScheduleConfig] = Field(
        default=None,
        title="Active hours",
        description="If set, notifications are only sent during the configured time slots. Camera-level active_hours overrides this global setting.",
    )
    enabled_in_config: Optional[bool] = Field(
        default=None,
        title="Original notifications state",
        description="Indicates whether notifications were enabled in the original static configuration.",
    )
