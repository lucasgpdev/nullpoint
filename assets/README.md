# Assets

Na Fase 1 todos os recursos são gerados por código — nada aqui é obrigatório para rodar o jogo:

| Recurso | Onde é gerado |
|---|---|
| Pistola P9 Warden + braços (1ª pessoa) | `client/src/weapons/WardenViewModel.ts` |
| Personagem (3ª pessoa) | `client/src/player/CharacterModel.ts` |
| Texturas do mapa (albedo + normal) | `client/src/maps/textures.ts` |
| Sons | `client/src/audio/AudioEngine.ts` (síntese WebAudio) |

## Pipeline previsto (Blender → jogo)

```
assets/models/<arma>.glb      malha + esqueleto + clipes: draw, fire, reload, inspect, idle
assets/textures/<material>/   baseColor, normal, roughness/metallic (KTX2 na Fase 7)
assets/sounds/<arma>/*.ogg    disparo, recarga, saque
```

- Exportar em glTF 2.0 binário (`.glb`), +Y para cima, metros, origem no punho.
- Criar empties com os nomes `muzzle`, `ejectPort`, `magazine`, `slide` — são os sockets que o código usa.
- Um `GltfViewModel` implementará a interface `ViewModel` (`client/src/weapons/ViewModel.ts`) usando `THREE.AnimationMixer`; as mecânicas não mudam.
- Use somente modelos/sons próprios ou com licença compatível (CC0/CC-BY com atribuição em `docs/CREDITS.md`).
