## Qué cambia y por qué


## Rama base
`develop` (o `main` solo si esto es un release o un `hotfix/*` — ver CONTRIBUTING.md)

## Issue relacionada
Closes #

## Checklist
- [ ] Probado en local sirviendo con `python3 -m http.server` (no `file://`)
- [ ] `node --test` pasa (y la CI está en verde)
- [ ] Si toqué `js/shared.js`, revisé que `buildBalancedPool` / `pickCandidates` siguen respetando `data/types/<tipo>/config.json` y añadí/ajusté tests en `tests/`
- [ ] Si añadí contenido (ingrediente/pizza), lo hice en `/data`, no hardcodeado en JS
- [ ] Documentación actualizada si el comportamiento visible cambió (README / PROJECT.md)
