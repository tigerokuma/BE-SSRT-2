import {
  IsDate,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
} from 'class-validator';

export class ConfirmTokenInsert {
  user_id: string;
  token: string;
  expires_at: Date;
}

enum WaitValue {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

export class EmailTime {
  id: string;
  last_email_time: Date;
  next_email_time: Date;
  wait_value: WaitValue;
  wait_unit: number;
}

export class EmailTimeInput {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  id: string;

  @IsDate()
  @IsDefined()
  first_email_time: Date;

  @IsEnum(WaitValue)
  @IsDefined()
  wait_value: WaitValue;

  @IsInt()
  @Min(1)
  @IsDefined()
  wait_unit: number;
}

export class User {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  user_id: string;
}

export class UpdateEmailTime {
  user_id: string;
  next_email_time: Date;
}

export class GetAlertsSince {
  user_id: string;
  last_email_time: Date;
}
