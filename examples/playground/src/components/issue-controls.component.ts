import { ChangeDetectionStrategy, Component, output } from '@angular/core';

@Component({
  selector: 'issue-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './issue-controls.component.html',
  styleUrl: './issue-controls.component.css',
})
export class IssueControlsComponent {
  readonly issueAdded = output<string>();

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
