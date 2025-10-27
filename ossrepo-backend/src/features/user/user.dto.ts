export class CreateUserRequest {
  email: string;
  name?: string;
}

export class UserResponse {
  user_id: string;
  email: string;
  name?: string;
  created_at: Date;
}
// src/modules/user/user.dto.ts
export class CreateOrUpdateFromClerkDto {
  clerk_id: string
  email?: string
  name?: string
}

export class UpdateUserDto {
  email?: string
  name?: string
}

export class IngestClerkGithubDto {
  clerk_id: string
}