import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'issue-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './issue-controls.component.html',
  styleUrl: './issue-controls.component.css',
})
export class IssueControlsComponent {
  readonly otherUser = input.required<string>();
  readonly mineOnly = input.required<boolean>();

  readonly issueAdded = output<string>();
  readonly userSwitched = output<void>();
  readonly authRotated = output<void>();
  readonly shortTokenRequested = output<void>();
  readonly filterToggled = output<void>();

  submitTitle(input: HTMLInputElement): void {
    const title = input.value.trim();
    if (title === '') {
      input.focus();
      return;
    }

    input.value = '';
    this.issueAdded.emit(title);
  }
}
