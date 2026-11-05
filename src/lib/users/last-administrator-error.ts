import { AppError } from '@/lib/errors';

/** Thrown when a change would leave no active administrator. Checked by type, not by message. */
export class LastAdministratorError extends AppError {
  constructor() {
    super({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'Operation would leave the system with no active administrators.',
    });
    this.name = 'LastAdministratorError';
  }
}
