import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  signal,
} from '@angular/core';
import type { MutateRequest, ReadonlyJSONValue } from '@rocicorp/zero';
import { injectZero } from 'ngx-zero';
import {
  IssueBoardComponent,
  type IssueCompletionChange,
} from './components/issue-board.component';
import { IssueControlsComponent } from './components/issue-controls.component';
import { PlaygroundHeaderComponent } from './components/playground-header.component';
import { instanceCreations, login, session } from './playground-state';
import { mutators } from './zero/mutators';
import { queries } from './zero/queries';
import type { Issue } from './zero/schema.gen';

@Component({
  selector: 'ngx-zero-playground',
  standalone: true,
  imports: [IssueBoardComponent, IssueControlsComponent, PlaygroundHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="shell">
      <playground-header
        [userID]="session()?.userID"
        [instanceCreations]="instanceCreations()"
        [queryState]="queryState()"
      />

      <issue-controls
        [otherUser]="otherUser()"
        [mineOnly]="mineOnly()"
        (issueAdded)="addIssue($event)"
        (userSwitched)="switchUser()"
        (authRotated)="rotateAuth()"
        (shortTokenRequested)="rotateAuth(15)"
        (filterToggled)="mineOnly.set(!mineOnly())"
      />

      <issue-board
        [issues]="issues()"
        [mineOnly]="mineOnly()"
        [lastAction]="lastAction()"
        [lastError]="lastError()"
        (completionChanged)="setCompleted($event)"
        (issueRemoved)="removeIssue($event)"
      />
    </main>
  `,
})
export class App {
  readonly zero = injectZero();
  readonly session = session;
  readonly instanceCreations = instanceCreations;

  readonly issues = signal<readonly Issue[]>([]);
  readonly queryState = signal('unknown');
  readonly mineOnly = signal(false);
  readonly lastAction = signal('');
  readonly lastError = signal('');
  readonly otherUser = computed(() =>
    session()?.userID === 'ada' ? 'grace' : 'ada',
  );

  constructor() {
    effect(onCleanup => {
      const zero = this.zero();
      const request = this.mineOnly() ? queries.issue.mine() : queries.issue.all();
      const view = zero.materialize(request);

      this.issues.set(view.data);
      const unsubscribe = view.addListener((data, resultType) => {
        this.issues.set(data);
        this.queryState.set(resultType);
      });

      onCleanup(() => {
        unsubscribe();
        view.destroy();
      });
    });
  }

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
    void this.relogin(this.otherUser());
  }

  rotateAuth(ttlSeconds?: number): void {
    const userID = session()?.userID ?? 'ada';
    void this.relogin(userID, ttlSeconds);
  }

  private async relogin(userID: string, ttlSeconds?: number): Promise<void> {
    this.lastAction.set('');
    this.lastError.set('');
    try {
      await login(userID, ttlSeconds);
      this.lastAction.set(
        ttlSeconds === undefined
          ? `Logged in as ${userID}`
          : `Logged in as ${userID} with a ${ttlSeconds}s token`,
      );
    } catch (error) {
      this.lastError.set(error instanceof Error ? error.message : String(error));
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
