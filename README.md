# Spatialgineers Experience Visualizer

This project is a complete rewrite of the original **Eternal Flame** visualiser.  It retains the core particle system but opens up every aspect for customisation.  Instead of a fixed flame effect the new visualiser allows you to choose how particles are emitted, what they look like, how they move and even define your own emission paths with your mouse.

## Features

- **Emitter presets** – pick from a simple point emitter, a circle, a line, a square or free‑hand drawing.
- **Behaviours** – choose how particles spawn and move: from the centre, from the bottom, from the top, randomly across the canvas or from evenly spaced bars.
- **Custom colours** – control the base colour of particles with a colour picker.
- **Textures** – upload one or more images to use as particle textures.  If multiple images are selected, each particle will randomly choose one.
- **Backgrounds** – upload a background image for the canvas or leave it solid black.
- **Path drawing** – select “Drawn Path” from the emitter dropdown, then draw directly on the canvas.  Particles will follow the path in a loop at a constant speed.
- **Responsive design** – the canvas resizes with your browser window; emitter shapes and paths reflow automatically.

## Getting started

This is a plain web application with no build step.  You can run it locally by opening `index.html` in your browser or by serving it from a simple static server such as Python’s built‑in HTTP server:

```sh
cd sgx
python3 -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000) in your browser.

## Repository structure

- `index.html` – entry point for the application.
- `style.css` – all styling for the controls and canvas.
- `script.js` – the main JavaScript module implementing the particle system and UI interactions.
- `README.md` – this file.

## Contributing and deployment

The repository `SGX` (Spatialgineers Experience Visualizer) should already be created under your GitHub account.  To deploy this application there, copy the contents of this `sgx` directory into the root of that repository and commit the changes.  GitHub Pages or another static hosting service can then serve the files directly.

If you encounter issues or have suggestions for new behaviours or shapes, feel free to open an issue or submit a pull request.