import {
  ChangeDetectionStrategy,
  Component,
  effect,
  signal
} from '@angular/core';
import { injectZero } from 'ngx-zero';
import { activeUserID, auth } from './playground-state';

@Component({
  selector: 'ngx-zero-playground',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="shell">
      <button (click)="counter.set(counter() + 1)">counter: {{ counter() }}</button>
       <div class="user-switcher">
          <span>Rotate the provided instance</span>
          <button type="button" (click)="switchUser()">
            Switch to {{ activeUserID() === 'ada' ? 'grace' : 'ada' }}
          </button>

          <button type="button" (click)="rotateAuth()">
            Rotate auth
          </button>
        </div>
    </main>
  `,
})
export class App {
  readonly zero = injectZero();
  readonly activeUserID = activeUserID;
  readonly counter = signal(0);
  // readonly instanceCreations = instanceCreations;
  // readonly issues = signal<readonly Issue[]>([]);
  // readonly queryState = signal('unknown');
  // readonly pendingMutations = signal(0);
  // readonly lastAction = signal('');
  // readonly lastError = signal('');
  // readonly openCount = computed(
  //   () => this.issues().filter(issue => !issue.completed).length,
  // );
  // readonly instanceUserID = computed(() => this.zero().userID ?? 'anonymous');

  constructor() {
    effect(() => {
      console.log(this.zero());
    })
    // effect(onCleanup => {
    //   const zero = this.zero();
    //   const view = zero.materialize(queries.issue.orderBy('createdAt', 'desc'));

    //   this.issues.set(view.data);
    //   const unsubscribe = view.addListener((data, resultType, error) => {
    //     this.issues.set(data);
    //     this.queryState.set(resultType);
    //     if (error !== undefined) {
    //       this.lastError.set(String(error));
    //     }
    //   });

    //   onCleanup(() => {
    //     unsubscribe();
    //     view.destroy();
    //   });
    // });
  }

  // addIssue(input: HTMLInputElement): void {
  //   const title = input.value.trim();
  //   if (title === '') {
  //     input.focus();
  //     return;
  //   }

  //   input.value = '';
  //   void this.runMutation(
  //     mutators.issue.create({
  //       id: crypto.randomUUID(),
  //       title,
  //       completed: false,
  //       createdAt: Date.now(),
  //     }),
  //     `Added “${title}”`,
  //   );
  // }

  // setCompleted(issue: Issue, completed: boolean): void {
  //   void this.runMutation(
  //     mutators.issue.setCompleted({ id: issue.id, completed }),
  //     completed ? `Completed “${issue.title}”` : `Reopened “${issue.title}”`,
  //   );
  // }

  // removeIssue(issue: Issue): void {
  //   void this.runMutation(mutators.issue.remove({ id: issue.id }), `Deleted “${issue.title}”`);
  // }

  rotateAuth(): void {
    auth.update(auth => `${auth}-yyyyy`);
  }

  switchUser(): void {
    // this.lastAction.set('');
    // this.lastError.set('');
    activeUserID.update(userID => (userID === 'ada' ? 'grace' : 'ada'));
  }

  // private async runMutation<TInput extends ReadonlyJSONValue | undefined>(
  //   request: MutateRequest<TInput>,
  //   successMessage: string,
  // ): Promise<void> {
  //   this.pendingMutations.update(count => count + 1);
  //   this.lastError.set('');

  //   try {
  //     const result = await this.zero().mutate(request).client;
  //     this.handleClientResult(result, successMessage);
  //   } catch (error) {
  //     this.lastError.set(error instanceof Error ? error.message : String(error));
  //   } finally {
  //     this.pendingMutations.update(count => count - 1);
  //   }
  // }

  // private handleClientResult(result: MutatorResultDetails, successMessage: string): void {
  //   if (result.type === 'error') {
  //     this.lastError.set(result.error.message);
  //     return;
  //   }
  //   this.lastAction.set(successMessage);
  // }
}
