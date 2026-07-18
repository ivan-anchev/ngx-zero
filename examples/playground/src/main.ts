import '@angular/compiler';
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideZero, withBootstrap } from 'ngx-zero';
import { App } from './app';
import { activeUserID, auth, initializeInstance } from './playground-state';
import { mutators } from './zero/mutators';
import { schema } from './zero/schema.gen';
import './styles.css';

// Local-only mutations never receive a server acknowledgement. Keep the
// playground console focused on app errors when an instance is intentionally
// closed during user rotation.
const localLogSink = { log: () => { } };

void bootstrapApplication(App, {
  providers: [
    provideZonelessChangeDetection(),
    provideZero(
      () => ({
        schema,
        mutators,
        userID: activeUserID(),
        context: { userID: activeUserID() },
        auth: auth(),
        cacheURL: null,
        server: null,
        kvStore: 'mem',
        logLevel: 'error',
        logSink: localLogSink,
      }),
      withBootstrap(initializeInstance),
    ),
  ],
}).catch((error: unknown) => console.error(error));
