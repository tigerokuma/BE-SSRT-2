export class ConfirmTokenInsert {
    user_id: string;
    token: string;
    expires_at: Date;
}

enum WaitValue {
    DAY = 'DAY',
    WEEK = 'WEEK',
    MONTH = 'MONTH',
    YEAR = 'YEAR'
}

export class EmailTime {
    id: string;
    last_email_time: Date;
    next_email_time: Date;
    wait_value: WaitValue;
    wait_unit: number;
}

export class EmailTimeInput {
    id: string;
    first_email_time: Date;
    wait_value: WaitValue;
    wait_unit: number;
}

export class User {
    user_id: string
}