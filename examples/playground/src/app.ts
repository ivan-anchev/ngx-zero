import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  signal,
} from '@angular/core';
import type { MutateRequest, ReadonlyJSONValue } from '@rocicorp/zero';
import { injectZero } from 'ngx-zero';
import { instanceCreations, login, session } from './playground-state';
import { mutators } from './zero/mutators';
import { queries } from './zero/queries';
import type { Issue } from './zero/schema.gen';

@Component({
  selector: 'ngx-zero-playground',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">ngx-zero playground</p>
          <h1>Issues</h1>
          <p class="lede">
            A real Zero backend: Postgres → zero-cache → this app. Mutations are
            optimistic locally and authoritative on the server — try a title
            containing “rollback” to watch the server reject it.
          </p>
        </div>
        <aside class="runtime">
          <div>
            <span>Signed in as</span>
            <strong class="status"><i></i>{{ session()?.userID }}</strong>
          </div>
          <div>
            <span>Zero instances created</span>
            <strong>{{ instanceCreations() }}</strong>
          </div>
          <div>
            <span>Query state</span>
            <strong>{{ queryState() }}</strong>
          </div>
        </aside>
      </header>

      <section class="toolbar">
        <div>
          <label for="new-issue">Add an issue</label>
          <div class="input-row">
            <input
              id="new-issue"
              placeholder="e.g. Wire up injectQuery"
              (keydown.enter)="addIssue(titleInput)"
              #titleInput
            />
            <button class="primary" type="button" (click)="addIssue(titleInput)">
              Add
            </button>
          </div>
        </div>
        <div class="user-switcher">
          <span>Session</span>
          <button type="button" (click)="switchUser()">
            Switch to {{ otherUser() }}
          </button>
          <button type="button" (click)="rotateAuth()">Rotate auth</button>
          <button type="button" (click)="rotateAuth(15)">15s token</button>
          <button type="button" (click)="mineOnly.set(!mineOnly())">
            {{ mineOnly() ? 'Show all issues' : 'Show only mine' }}
          </button>
        </div>
      </section>

      <section class="board">
        <div class="board-heading">
          <h2>{{ mineOnly() ? 'My issues' : 'All issues' }}</h2>
          <span class="count">
            {{ openCount() }} open · {{ issues().length }} total
          </span>
        </div>

        @if (lastError()) {
          <p class="notice error">{{ lastError() }}</p>
        } @else if (lastAction()) {
          <p class="notice">{{ lastAction() }}</p>
        }

        <ul class="issue-list">
          @for (issue of issues(); track issue.id) {
            <li [class.completed]="issue.completed">
              <label>
                <input
                  type="checkbox"
                  [checked]="issue.completed"
                  (change)="setCompleted(issue, !issue.completed)"
                />
                <span>
                  <strong>{{ issue.title }}</strong>
                  <small>owned by {{ issue.ownerId }}</small>
                </span>
              </label>
              <button class="danger" type="button" (click)="removeIssue(issue)">
                Delete
              </button>
            </li>
          } @empty {
            <li class="empty">
              <span>No issues synced yet — add one above.</span>
            </li>
          }
        </ul>
      </section>
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
  readonly openCount = computed(
    () => this.issues().filter(issue => !issue.completed).length,
  );
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

  addIssue(input: HTMLInputElement): void {
    const title = input.value.trim();
    if (title === '') {
      input.focus();
      return;
    }

    input.value = '';
    void this.runMutation(
      mutators.issue.create({
        id: crypto.randomUUID(),
        title,
        createdAt: Date.now(),
      }),
      `Added “${title}”`,
    );
  }

  setCompleted(issue: Issue, completed: boolean): void {
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
