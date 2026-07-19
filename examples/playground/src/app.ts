import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import type { MutateRequest, ReadonlyJSONValue } from '@rocicorp/zero';
import { injectQuery, injectZero } from 'ngx-zero';
import {
  IssueBoardComponent,
  type IssueCompletionChange,
} from './components/issue-board.component';
import { IssueControlsComponent } from './components/issue-controls.component';
import { PlaygroundHeaderComponent } from './components/playground-header.component';
import { SessionControlsComponent } from './components/session-controls.component';
import { instanceCreations, login, session } from './playground-state';
import { mutators } from './zero/mutators';
import { queries } from './zero/queries';
import type { Issue } from './zero/schema.gen';

@Component({
  selector: 'ngx-zero-playground',
  standalone: true,
  imports: [
    IssueBoardComponent,
    IssueControlsComponent,
    PlaygroundHeaderComponent,
    SessionControlsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="shell">
      <playground-header
        [userID]="session()?.userID"
        [instanceCreations]="instanceCreations()"
        [queryState]="issuesQuery.status()"
        [authPending]="authAction() !== undefined"
      />

      <session-controls
        [otherUser]="otherUser()"
        [authAction]="authAction()"
        [status]="sessionStatus()"
        (userSwitched)="switchUser()"
        (authRotated)="rotateAuth()"
        (shortTokenRequested)="rotateAuth(15)"
      />

      <issue-controls
        (issueAdded)="addIssue($event)"
      />

      <issue-board
        [issues]="issuesQuery.data()"
        [mineOnly]="mineOnly()"
        [loading]="issuesQuery.status() === 'unknown'"
        [lastAction]="lastAction()"
        [lastError]="lastError()"
        (completionChanged)="setCompleted($event)"
        (issueRemoved)="removeIssue($event)"
        (filterToggled)="mineOnly.set(!mineOnly())"
      />
    </main>
  `,
})
export class App {
  readonly zero = injectZero();
  readonly session = session;
  readonly instanceCreations = instanceCreations;

  readonly mineOnly = signal(false);
  readonly lastAction = signal('');
  readonly lastError = signal('');
  readonly authAction = signal<string | undefined>(undefined);
  readonly sessionStatus = signal('Authentication and instance recreation');
  readonly otherUser = computed(() =>
    session()?.userID === 'user1' ? 'user2' : 'user1',
  );

  readonly issuesQuery = injectQuery(
    () => (this.mineOnly() ? queries.issue.mine() : queries.issue.all()),
    { keepPreviousData: true },
  );

  #loginGeneration = 0;

  addIssue(title: string): void {
    void this.runMutation(
      mutators.issue.create({
        id: crypto.randomUUID(),
        title,
        createdAt: Date.now(),
      }),
      `Added “${title}”`,
    );
  }

  setCompleted({ issue, completed }: IssueCompletionChange): void {
    void this.runMutation(
      mutators.issue.setCompleted({ id: issue.id, completed }),
      completed ? `Completed “${issue.title}”` : `Reopened “${issue.title}”`,
    );
  }

  removeIssue(issue: Issue): void {
    void this.runMutation(
      mutators.issue.remove({ id: issue.id }),
      `Deleted “${issue.title}”`,
    );
  }

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
    const generation = ++this.#loginGeneration;
    this.lastAction.set('');
    this.lastError.set('');
    this.authAction.set(pendingLabel);

    try {
      const applied = await login(userID, ttlSeconds);
      if (!applied || generation !== this.#loginGeneration) {
        return;
      }

      this.sessionStatus.set(
        userChanged
          ? `Switched to ${userID}`
          : ttlSeconds === undefined
            ? 'Auth refreshed'
            : `${ttlSeconds}s token active`,
      );
    } catch (error) {
      if (generation !== this.#loginGeneration) {
        return;
      }
      this.lastError.set(error instanceof Error ? error.message : String(error));
      this.sessionStatus.set('Session action failed');
    } finally {
      if (generation === this.#loginGeneration) {
        this.authAction.set(undefined);
      }
    }
  }

  private async runMutation<TInput extends ReadonlyJSONValue | undefined>(
    request: MutateRequest<TInput>,
    successMessage: string,
  ): Promise<void> {
    this.lastError.set('');

    const result = this.zero().mutate(request);
    const client = await result.client;
    if (client.type === 'error') {
      this.lastError.set(`Optimistic apply failed: ${client.error.message}`);
      return;
    }

    this.lastAction.set(successMessage);
    const server = await result.server;
    if (server.type === 'error') {
      this.lastError.set(`Server rejected “${successMessage}”: ${server.error.message}`);
    }
  }
}
