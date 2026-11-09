import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './ui/styles.css';
import { App } from './ui/App';

const root = document.getElementById('app')!;
// As fontes precisam estar carregadas antes de desenhar textos em canvas (placas, nomes).
document.fonts.ready.finally(() => {
  (window as unknown as { nullpoint: App }).nullpoint = new App(root);
});
