import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { Issue } from '../zero/schema.gen';

export interface IssueCompletionChange {
  readonly issue: Issue;
  readonly completed: boolean;
}

@Component({
  selector: 'issue-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './issue-board.component.html',
  styleUrl: './issue-board.component.css',
})
export class IssueBoardComponent {
  readonly issues = input.required<readonly Issue[]>();
  readonly mineOnly = input.required<boolean>();
  readonly lastAction = input.required<string>();
  readonly lastError = input.required<string>();

  readonly completionChanged = output<IssueCompletionChange>();
  readonly issueRemoved = output<Issue>();

  readonly openCount = computed(
    () => this.issues().filter(issue => !issue.completed).length,
  );

  toggle(issue: Issue): void {
    this.completionChanged.emit({ issue, completed: !issue.completed });
  }
}
