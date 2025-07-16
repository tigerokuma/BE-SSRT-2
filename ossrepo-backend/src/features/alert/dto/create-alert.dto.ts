enum Risk {
    LOW = "LOW",
    MODERATE = "MODERATE",
    HIGH = "HIGH",
    CRITICAL = "CRITICAL"
}

enum Status {
    OPEN = "OPEN",
    REVIEWED = "REVIEWED",
    CLOSED = "CLOSED"
}

export class CreateAlertDto {
    risk: Risk;
    status: Status;
    title: string;
    description: string;
}

export class UpdateAlertDto {
    risk?: Risk;
    status?: Status;
    title?: string;
    description?: string;
}
