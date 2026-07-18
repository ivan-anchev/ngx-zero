import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'playground-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './playground-header.component.html',
  styleUrl: './playground-header.component.css',
})
export class PlaygroundHeaderComponent {
  readonly userID = input.required<string | undefined>();
  readonly instanceCreations = input.required<number>();
  readonly queryState = input.required<string>();
}
