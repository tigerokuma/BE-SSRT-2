import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class CommitSummaryDto {
  @ApiProperty({
    description: 'Number of recent commits to summarize (default: 10, max: 50)',
    example: 10,
    required: false,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  commitCount?: number = 10;
}

export class CommitSummaryResponseDto {
  @ApiProperty({
    description: 'AI-generated summary of recent commits',
    example: 'Recent commits show active development on the authentication system, with 3 commits adding new login features and 2 commits fixing security vulnerabilities.',
  })
  summary: string;

  @ApiProperty({
    description: 'Number of commits analyzed',
    example: 10,
  })
  commitCount: number;

  @ApiProperty({
    description: 'Date range of commits analyzed',
    example: '2024-01-01 to 2024-01-15',
  })
  dateRange: string;

  @ApiProperty({
    description: 'Total lines added across all commits',
    example: 1250,
  })
  totalLinesAdded: number;

  @ApiProperty({
    description: 'Total lines deleted across all commits',
    example: 450,
  })
  totalLinesDeleted: number;

  @ApiProperty({
    description: 'Total files changed across all commits',
    example: 25,
  })
  totalFilesChanged: number;

  @ApiProperty({
    description: 'Unique authors who made commits',
    example: ['john.doe@example.com', 'jane.smith@example.com'],
  })
  authors: string[];

  @ApiProperty({
    description: 'When the summary was generated',
    example: '2024-01-15T10:30:00Z',
  })
  generatedAt: Date;
} 