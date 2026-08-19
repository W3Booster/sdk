/*
 * Compile-time assignability checks for the private JavaScript runtimes.
 * These complement the generated facades: inferred implementation values must
 * satisfy every published value signature before the package can be released.
 */
import * as PublicRoot from '../src/index.js';
import * as RuntimeRoot from '../src/index.runtime.js';
import * as PublicSelectors from '../src/selectors.js';
import * as RuntimeSelectors from '../src/selectors.runtime.js';
import * as PublicStore from '../src/store.js';
import * as RuntimeStore from '../src/store.runtime.js';
import * as PublicApp from '../src/app.js';
import * as RuntimeApp from '../src/app.runtime.js';
import * as PublicStandardGame from '../src/standard-game.js';
import * as RuntimeStandardGame from '../src/standard-game.runtime.js';
import * as PublicAssets from '../src/assets.js';
import * as RuntimeAssets from '../src/assets.runtime.js';

const rootRuntime: typeof PublicRoot = RuntimeRoot;
const selectorsRuntime: typeof PublicSelectors = RuntimeSelectors;
const storeRuntime: typeof PublicStore = RuntimeStore;
const appRuntime: typeof PublicApp = RuntimeApp;
const standardGameRuntime: typeof PublicStandardGame = RuntimeStandardGame;
const assetsRuntime: typeof PublicAssets = RuntimeAssets;

void [rootRuntime, selectorsRuntime, storeRuntime, appRuntime, standardGameRuntime, assetsRuntime];
