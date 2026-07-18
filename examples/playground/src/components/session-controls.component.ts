import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'session-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-controls.component.html',
  styleUrl: './session-controls.component.css',
})
export class SessionControlsComponent {
  readonly otherUser = input.required<string>();
  readonly authAction = input.required<string | undefined>();
  readonly status = input.required<string>();

  readonly userSwitched = output<void>();
  readonly authRotated = output<void>();
  readonly shortTokenRequested = output<void>();
}
