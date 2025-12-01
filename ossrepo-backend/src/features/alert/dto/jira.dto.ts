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