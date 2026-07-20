import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { login, session } from '../playground-state';

@Component({
  selector: 'session-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-controls.component.html',
  styleUrl: './session-controls.component.css',
})
export class SessionControlsComponent {
  readonly authAction = signal<string | undefined>(undefined);
  readonly status = signal('Authentication and instance recreation');
  readonly otherUser = computed(() =>
    session()?.userID === 'user1' ? 'user2' : 'user1',
  );

  switchUser(): void {
    const userID = this.otherUser();
    void this.relogin(userID, undefined, `Switching to ${userID}…`);
  }

  rotateAuth(ttlSeconds?: number): void {
    const userID = session()?.userID ?? 'user1';
    void this.relogin(
      userID,
      ttlSeconds,
      ttlSeconds === undefined ? 'Refreshing auth…' : 'Issuing short-lived token…',
    );
  }

  private async relogin(
    userID: string,
    ttlSeconds: number | undefined,
    pendingLabel: string,
  ): Promise<void> {
    const userChanged = session()?.userID !== userID;
    this.authAction.set(pendingLabel);

    try {
      if (!(await login(userID, ttlSeconds))) {
        return;
      }
      this.status.set(
        userChanged
          ? `Switched to ${userID}`
          : ttlSeconds === undefined
            ? 'Auth refreshed'
            : `${ttlSeconds}s token active`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status.set(`Session action failed: ${message}`);
    } finally {
      this.authAction.set(undefined);
    }
  }
}
