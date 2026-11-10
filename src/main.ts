import './style.css';
import { getAuthState, onAuthStateChange } from './ui/auth-hook.ts';
import { captureScreen } from './ui/capture-screen.ts';
import { createConvertScreen } from './ui/convert-screen.ts';
import { homeScreen } from './ui/home-screen.ts';
import { registerScreen, startRouter } from './ui/router.ts';

registerScreen('', homeScreen);
registerScreen('schrift', captureScreen);
registerScreen('umwandeln', createConvertScreen());

const authEl = document.querySelector<HTMLElement>('#auth-status')!;
const showAuth = (): void => {
  const s = getAuthState();
  authEl.textContent = s.label;
  authEl.dataset.signedIn = String(s.signedIn);
};
showAuth();
onAuthStateChange(showAuth);

startRouter(document.querySelector<HTMLElement>('#app')!);
