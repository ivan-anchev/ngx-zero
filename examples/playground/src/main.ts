import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideZero, withBootstrap } from 'ngx-zero';
import { App } from './app';
import { contextFor, initializeInstance, login, session } from './playground-state';
import './styles.css';
import { mutators } from './zero/mutators';
import { schema } from './zero/schema.gen';

await login('user1');

void bootstrapApplication(App, {
  providers: [
    provideZonelessChangeDetection(),
    provideZero(
      () => {
        const { userID, token } = session()!;
        return {
          schema,
          mutators,
          userID,
          auth: token,
          context: contextFor(userID),
          cacheURL: import.meta.env['VITE_PUBLIC_ZERO_CACHE_URL'] as string,
          kvStore: 'mem',
          logLevel: 'error',
        };
      },
      withBootstrap(initializeInstance),
    ),
  ],
}).catch((error: unknown) => console.error(error));
