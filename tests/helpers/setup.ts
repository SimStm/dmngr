import { setDefaultTimeout } from "bun:test";

// Carregado via bunfig.toml antes de cada arquivo de teste.
//
// Os testes de dmngr chamam ferramentas do sistema (`codesign`, `lipo`, `plutil`, `hdiutil`,
// `installer`), e a primeira invocação num runner de CI recém-criado é bem mais lenta do que num
// Mac já usado — o padrão de 5s do Bun já causou um timeout falso. Suítes que precisam de mais tempo
// (integração com DMG/PKG reais) continuam chamando setDefaultTimeout() com o próprio valor.
setDefaultTimeout(30_000);
