// JIT compiler: TestBed's dynamic testing module needs it (partial ɵɵngDeclare*
// declarations in Angular packages are linked at runtime).
import '@angular/compiler';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
