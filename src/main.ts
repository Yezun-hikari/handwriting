import './style.css';
import { startAccount } from './ui/auth-hook.ts';
import { captureScreen } from './ui/capture-screen.ts';
import { createConvertScreen } from './ui/convert-screen.ts';
import { homeScreen } from './ui/home-screen.ts';
import { refreshScreen, registerScreen, startRouter } from './ui/router.ts';

registerScreen('', homeScreen);
registerScreen('schrift', captureScreen);
registerScreen('umwandeln', createConvertScreen());

// Chooses the glyph store (account or this browser) before the first screen loads glyphs.
startAccount({ onSettingsApplied: refreshScreen });

startRouter(document.querySelector<HTMLElement>('#app')!);
