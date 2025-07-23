import { IsString, IsNotEmpty, IsDefined } from "class-validator";

export class JiraInsert {
    @IsString()
    @IsNotEmpty()
    @IsDefined()
    userId: string;

    @IsString()
    @IsNotEmpty()
    @IsDefined()
    webtriggerUrl: string;

    @IsString()
    @IsNotEmpty()
    @IsDefined()
    projectKey: string;
}

export class JiraIssue {
    userID: string;
    summary: string;
    description: string;
}