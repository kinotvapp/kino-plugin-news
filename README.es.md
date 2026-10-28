# Solo noticias

[English](README.md) · [Para desarrolladores (en inglés)](DEVELOPERS.md)

<img src="icon.png" width="96" alt="Ícono de Solo noticias" align="right">

Un plugin de [Kino](https://github.com/kinotvapp/kino-light) que agrega una **pantalla de noticias**: noticias de las
películas y series que viste y de tus propios temas, en una cuadrícula de tarjetas, en tu celular y en tu TV. Lee los
canales gratuitos de [Google Noticias](https://news.google.com) directo desde tu aparato: sin cuenta, sin clave y sin
ningún servidor de por medio.

- **Tus temas**: escribe los términos que te interesan (una saga, un actor, un festival). Con **Usar lo que he visto**
  encendido se suman los títulos que viste hace poco en Kino.
- **Tarjetas** con la imagen, el medio, hace cuánto, el titular y por qué está ahí («Porque viste «Avatar»»). Toca una
  para leer un extracto de la noticia y **Ver noticia** para leerla completa en tu navegador (en la TV, un código QR la
  lleva a tu celular).
- **Categorías** como pestañas sobre las tarjetas: se adivinan en tu aparato, o las elige la IA de texto de Kino si la
  enciendes.
- **Actualización automática opcional** en segundo plano, para que las noticias estén listas al abrir la pantalla. Los
  aparatos vinculados comparten el resultado: tu celular hace el trabajo y tu TV solo lo muestra.
- **Actualiza a mano** con la flecha circular cuando quieras.

No oficial: sin relación con Google. Google Noticias solo se lee, como un lector de noticias personal en tu propio
aparato.

## Capturas

<!-- Por agregar antes de publicar, en screenshots/:
  1-news-phone.jpg       la pestaña Noticias en un celular, con las pestañas de categorías
  2-story-phone.jpg      una noticia abierta en su ventana
  3-settings-phone.jpg   la pestaña Configuración
  4-news-tv.jpg          la pestaña Noticias en una TV
  5-story-tv.jpg         una noticia en la TV, con su código QR
-->
_Muy pronto._

## Instalar

Necesita una versión de Kino con pantallas de plugin (`apiVersion` 14 del plugin); un Kino más viejo dice «Este plugin
necesita una versión más nueva de Kino».

1. En el celular, abre **Menú ▸ Plugins** y toca **+** (Agregar plugin). En la TV, abre **Plugins** y elige **Agregar
   plugin**.
2. Deja el tipo en **Kino**. En **Dirección del plugin**, escribe `kinotvapp/kino-plugin-news` y toca **Agregar**.
3. Kino muestra **Instalar Solo noticias**. Toca **Ver detalles**, lee las líneas (abajo te explicamos cada una) y toca
   **Instalar**.
4. **Noticias** aparece en el menú de Kino (la tira de Inicio del celular, la barra lateral de la TV). Ábrela.

El plugin está **firmado por su autor** («Firmado por su autor» en la hoja de instalación): Kino comprueba que cada
actualización venga firmada con la misma clave.

## Los permisos, en palabras simples

Lo que Kino muestra al instalar, y qué quiere decir cada línea aquí:

| Kino dice | Qué significa en este plugin |
| --- | --- |
| **Se conecta a: news.google.com** | Lee los canales (RSS) de Google Noticias de tus temas. |
| **Puede conectarse a cualquier servidor público de internet (solo https, nunca tu red local)** (en rojo) | Las noticias vienen de muchos medios. Para mostrar la imagen y el texto de una noticia, tu aparato abre su página en el sitio del medio. Solo con **Imágenes y textos de los medios** encendido (viene encendido); apagado, el plugin solo habla con Google Noticias. Nunca tu red local. |
| **Podrá leer lo que has visto y guardado en Kino, y enviarlo a sus servicios** (en rojo) | Solo con **Usar lo que he visto** encendido (viene apagado): los títulos que viste más recientemente (5 por defecto, hasta 50) se envían a Google Noticias **como términos de búsqueda**. Nada más de tu historial sale de tu aparato, y nunca un título +18. También puedes apagarlo en Ajustes: **Dejar que lea lo que he visto y guardado**. |
| **Podrá ejecutarse en segundo plano cada cierto tiempo para actualizar sus datos, usando internet y batería** (en rojo) | La actualización automática. Empieza **apagada**: enciéndela en Ajustes ▸ Noticias de Kino y elige cada cuánto (de 15 minutos a una vez al día; por defecto solo con Wi-Fi). |
| **Podrá enviar texto a un servicio de IA de terceros (Kilo) para que lo resuma o clasifique; lo que envíe sale de tu aparato** (en rojo) | Solo con **Clasificar con IA** encendido (viene apagado): los **titulares** (el texto del titular y un número, nada más) van a la IA de texto de Kino para elegir su categoría. Nunca tu historial ni tus términos. Apagado, las categorías se adivinan en tu aparato. |
| **Guarda unos pocos resultados que se sincronizan entre tus aparatos vinculados** | Las últimas noticias se comparten entre tus propios aparatos vinculados (solo tu perfil), para que la TV no repita el trabajo del celular. |

Cada permiso en rojo se puede apagar después en la pestaña del plugin en los Ajustes de Kino, sin desinstalarlo.

## Configuración

En la pestaña **Configuración** de la pantalla (cada cambio se guarda al instante):

- **Imágenes y textos de los medios** (encendido): imágenes y descripciones de las páginas de los medios. Apagado: solo
  titulares, y ninguna conexión con los medios.
- **Clasificar con IA** (apagado), y **Clasificar ahora** para ordenar ya las noticias que tienes.
- **Usar lo que he visto** (apagado) y **Títulos recientes** (1 a 50): los títulos que viste hace poco se vuelven temas.
  Aparecen como filas que puedes quitar una por una.
- **Títulos de ejemplo** (apagado): prueba el plugin sin historial (Avatar, Breaking Bad, Dune…, como si los hubieras
  visto). No se lee nada de tu biblioteca.
- **Tus términos**: agrega o quita tus propios temas (hasta 50 en total, de 40 caracteres cada uno).

Cada cuánto se actualizan solas las noticias no está en esta pantalla: es la fila del trabajo en **Ajustes ▸ Noticias**
de Kino.

## La actualización automática

- Un trabajo, **Actualizar las noticias**, cada 60 minutos por defecto (15 min, 30 min, 1 h, 3 h, 12 h o 24 h).
- Está **apagado** hasta que lo enciendas, y Kino lo hace solo con Wi-Fi salvo que cambies eso.
- Con un celular y una TV vinculados, lo hace el celular y la TV lee el resultado; una TV sola lo hace ella misma, con
  menos carga.
- Cada vuelta es pequeña: unas pocas peticiones, menos de 2 MB, y se detiene cuando se le acaba el tiempo. La siguiente
  sigue donde quedó.
- Sin él, la pantalla actualiza lo viejo al abrirla, y la flecha actualiza a mano (como mucho una vez cada 30 segundos).

## Privacidad

- **Sin cuenta y sin servidor nuestro.** Todo corre dentro de Kino, en tu aparato.
- **Google Noticias** recibe tus términos de búsqueda: los tuyos y, solo con **Usar lo que he visto** encendido, los
  títulos que viste hace poco. Google los ve como cualquier búsqueda desde tu conexión.
- **Los medios**: con **Imágenes y textos de los medios** encendido, tu aparato abre las páginas de las noticias de tu
  lista (para leer su imagen y su descripción) y la de la noticia que abras (para leer su texto). Los medios lo ven como
  cualquier visita a su sitio.
- **IA**: apagada por defecto. Encendida, solo se envían titulares.
- **Aparatos vinculados**: las noticias (titulares, medios, enlaces, categorías) y los títulos que quitaste se
  sincronizan entre tus propios aparatos con la sincronización de Kino. Nunca una contraseña ni un token.
- Al quitar el plugin se borra lo que guardó.

## Sobre Google Noticias

El plugin lee los canales RSS públicos de Google Noticias como un lector de noticias personal, que es el uso que
permiten las condiciones de Google. Muestra el titular, el medio y un extracto corto, y siempre enlaza a la página del
propio medio para leer la noticia completa. Convertir los enlaces nuevos de Google en la dirección del medio usa las
mismas peticiones que hace la propia página de Google: eso no es oficial y puede dejar de funcionar; entonces **Ver
noticia** se queda con el enlace de Google.

## Si algo falla

- **«Sin conexión» junto a la hora**: la última actualización no pudo leer Google Noticias. Revisa tu conexión y toca la
  flecha; mientras tanto se quedan las noticias guardadas.
- **«Espera un momento: acabas de actualizar»**: actualizaste hace menos de 30 segundos.
- **Sin imágenes**: **Imágenes y textos de los medios** está apagado, o el medio no tiene; la tarjeta muestra entonces la
  inicial del medio.
- **Solo noticias generales, nada mío**: no tienes términos y **Usar lo que he visto** está apagado (o tu historial está
  vacío). Agrega un término, o prueba **Títulos de ejemplo**.
- **Las categorías no cambian**: **Clasificar con IA** está apagado, o la IA de Kino no está disponible o está apagada en
  la pestaña del plugin en Ajustes (**Dejar que use la IA de texto**); se quedan las que se adivinan en el aparato.
- **La actualización en segundo plano nunca corre**: enciende el trabajo en Ajustes ▸ Noticias, y revisa ahí **Dejar
  que trabaje en segundo plano** y el interruptor de solo Wi-Fi.
- **El extracto es corto o está cortado**: se lee de la página del medio y puede salir incompleto (sitios de pago).
  **Ver noticia** abre la noticia completa.

## Cómo está organizado el código

El código que se lee vive en `src/`, un archivo pequeño por responsabilidad. Kino instala UN archivo, `plugin.js` (el
`entry` del manifiesto), así que `npm run build` empaca `src/` en él con [esbuild](https://esbuild.github.io/): un solo
módulo ES legible (sin minificar) con las mismas exportaciones, que empieza con una línea que dice que es generado.
`plugin.js` sigue en el repositorio (Kino lo instala directo de ahí y la firma cubre sus bytes); **nunca lo edites a mano**:
edita `src/` y corre `npm run build`. `npm run check:built` (y la prueba `test/built.test.mjs`) falla cuando `plugin.js`
no es exactamente lo que sale de `src/`.

```text
src/
  plugin.js        la entrada: solo reexporta la superficie pública (lo que Kino llama y lo que usan las pruebas)
  limits.js        límites y ritmo: términos, noticias, tarjetas, tamaños, frecuencias, el presupuesto del trabajo
  util/            html.js (entidades, etiquetas), time.js (fechas RSS, «hace 2 h»), text.js, values.js
  feed/            google-news.js: las ediciones, la dirección RSS, los enlaces de artículos, los ítems del feed
  store/           cache.js (kino.shared con kino.storage de respaldo, las claves), stories.js (la noticia guardada)
  terms/           terms.js (términos a consultas, en tandas), watched.js (lo que la persona vio como términos)
  filter/          adult.js: el filtro +18
  categories/      categories.js: la suposición por palabras clave y la IA de texto de Kino
  article/         page.js (la dirección del medio, su imagen y descripción), text.js (el texto de una noticia),
                   read-story.js (lo que muestra la ventana, leído con un toque)
  work/            schedule.js, stages.js, step.js (`step`, la cola de trabajo con presupuesto), manual.js
  state/           load.js: los ajustes, la biblioteca y el almacenamiento como los leen `step` y la pantalla
  ui/              samples.js, format.js, cards.js, story-popup.js, news-tab.js, settings-tab.js, header.js
  exports/         job.js (`job`), screen.js (`screen`), screen-event.js (`screenEvent`)
```

Las importaciones van en un solo sentido (util y limits, luego los lectores puros, luego work y state, luego ui, luego
exports): no hay ciclos. Cada archivo empieza con un comentario que dice de qué se encarga.

```sh
npm install          # una vez: esbuild
npm run build        # src/ -> plugin.js (nunca edites plugin.js a mano)
npm run check:built  # plugin.js es exactamente lo que sale de src/
npm test             # el plugin.js generado en la caja de arena del kit, y la revisión de arriba
npm run validate     # lo que diría Kino al instalarlo
npm run sign         # después de cada build que cambió plugin.js (la llave del autor, nunca en este repositorio)
```

El flujo completo está en [DEVELOPERS.md](DEVELOPERS.md) (en inglés).

## Licencia

[Apache License 2.0](LICENSE). Ver [NOTICE](NOTICE).

Repositorio: [kinotvapp/kino-plugin-news](https://github.com/kinotvapp/kino-plugin-news)
(remoto `git@github.com-kinotvapp:kinotvapp/kino-plugin-news.git`).
