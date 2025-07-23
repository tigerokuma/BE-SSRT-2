import { Injectable } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { CreateUserRequest } from './user.dto';

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async createUser(data: CreateUserRequest) {
    // Optionally add business logic here
    return this.userRepository.createUser(data);
  }

  async getUserById(user_id: string) {
    return this.userRepository.getUserById(user_id);
  }

  async getUserByEmail(email: string) {
    return this.userRepository.getUserByEmail(email);
  }

  async getAllUsers() {
    return this.userRepository.getAllUsers();
  }
} 