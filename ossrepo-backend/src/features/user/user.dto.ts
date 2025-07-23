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