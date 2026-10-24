# Сторонние компоненты

- Three.js — MIT. Код находится в `vendor/three/`, лицензия — [THREE-LICENSE.txt](vendor/three/THREE-LICENSE.txt).
- Golos Text — SIL Open Font License. Файлы находятся в `assets/fonts/`, лицензия — [golostext-OFL.txt](assets/fonts/golostext-OFL.txt).
- Manrope — SIL Open Font License. Лицензия — [manrope-OFL.txt](assets/fonts/manrope-OFL.txt).
- ws — MIT, только для сетевого сервера. Устанавливается из npm по lock-файлу; лицензия включена в пакет `node_modules/ws/LICENSE`. [Исходники и лицензия](https://github.com/websockets/ws).
- https-proxy-agent — MIT, только для исходящих проверок сервера через настроенный прокси. Зависимости и лицензии сохраняются npm по lock-файлу. [Исходники и лицензия](https://github.com/TooTallNate/proxy-agents/tree/main/packages/https-proxy-agent).
- cloudflared — Apache-2.0, необязательный резервный туннель. Бинарный файл загружается из официального релиза после проверки SHA-256 и не включается в репозиторий или игру. [Исходники и лицензия](https://github.com/cloudflare/cloudflared).
- Записи двигателей Sadiquecat и Joseph SARDIN — CC0 1.0. Обработанные петли, первичные страницы, лицензии и SHA-256 — [assets/audio/LICENSE.md](assets/audio/LICENSE.md). Встроены в автономную игру, не требуют сетевой загрузки.

Лицензии Three.js и шрифтов также включаются в готовый автономный HTML. `ws` не входит в браузерную сборку. Лицензии инструментов разработки сохраняются их npm-пакетами. Собственная лицензия проекта в этом репозитории пока не назначена.
