import { IsString, IsNotEmpty, IsDefined } from 'class-validator';

export class JiraInsert {
  user_id: string;
  webtrigger_url: string;
  project_key: string;
}

export class JiraIssue {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  user_watchlist_id: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  summary: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  description: string;
}

export class CheckJira {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  project_key: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  webtrigger_url: string;
}

export class TempJiraInfo {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  code: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  project_key: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  webtrigger_url: string;
}

export class TempJiraInsert {
  code: string;
  project_key: string;
  webtrigger_url: string;
  expires_at: Date;
}

export class LinkJira {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  user_id: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  code: string;
}
