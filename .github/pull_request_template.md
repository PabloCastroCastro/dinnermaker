## Qué cambia y por qué


## Rama base
`develop` (o `main` solo si esto es un release o un `hotfix/*` — ver CONTRIBUTING.md)

## Issue relacionada
Closes #

## Checklist
- [ ] Probado en local sirviendo con `python3 -m http.server` (no `file://`)
- [ ] Si toqué `js/shared.js`, revisé que `buildBalancedPool` / `pickCandidates` siguen respetando `data/types/<tipo>/config.json`
- [ ] Si toqué `/data/*.json`, sigue parseando y las pizzas no referencian ingredientes inexistentes
- [ ] Si añadí contenido (ingrediente/pizza), lo hice en `/data`, no hardcodeado en JS
- [ ] Documentación actualizada si el comportamiento visible cambió (README / PROJECT.md)
