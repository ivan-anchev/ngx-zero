import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { injectMutator, injectQuery } from 'ngx-zero';
import {
  IssueBoardComponent,
  type IssueCompletionChange,
} from './components/issue-board.component';
import { IssueControlsComponent } from './components/issue-controls.component';
import { PlaygroundHeaderComponent } from './components/playground-header.component';
import { SessionControlsComponent } from './components/session-controls.component';
import { instanceCreations, session } from './playground-state';
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
        [queryState]="issues.status()"
        [mutationPending]="mutationPending()"
      />

      <session-controls />

      <issue-controls (issueAdded)="addIssue($event)" />

      <issue-board
        [issues]="issues.data()"
        [mineOnly]="mineOnly()"
        [loading]="issues.status() === 'unknown'"
        [error]="mutationError()"
        (completionChanged)="setCompleted($event)"
        (issueRemoved)="removeIssue($event)"
        (filterToggled)="mineOnly.set(!mineOnly())"
      />
    </main>
  `,
})
export class App {
  readonly session = session;
  readonly instanceCreations = instanceCreations;

  readonly mineOnly = signal(false);

  readonly issues = injectQuery(() =>
    this.mineOnly() ? queries.issue.mine() : queries.issue.all(),
  );

  readonly createIssue = injectMutator(mutators.issue.create);
  readonly completeIssue = injectMutator(mutators.issue.setCompleted);
  readonly deleteIssue = injectMutator(mutators.issue.remove);

  readonly mutationPending = computed(
    () =>
      this.createIssue.pending() ||
      this.completeIssue.pending() ||
      this.deleteIssue.pending(),
  );
  readonly mutationError = computed(
    () =>
      (this.createIssue.error() ??
        this.completeIssue.error() ??
        this.deleteIssue.error())?.message,
  );

  addIssue(title: string): void {
    this.createIssue.mutate({
      id: crypto.randomUUID(),
      title,
      createdAt: Date.now(),
    });
  }

  setCompleted({ issue, completed }: IssueCompletionChange): void {
    this.completeIssue.mutate({ id: issue.id, completed });
  }

  removeIssue(issue: Issue): void {
    this.deleteIssue.mutate({ id: issue.id });
  }
}
