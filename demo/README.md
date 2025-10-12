# Genetic Assembly Demo

Interactive demos for the WebAssembly-based Multi-Objective Optimization solver.

## 🚀 Quick Start

### First Time Setup

```bash
# From project root, install demo dependencies
npm run demo:install

# OR manually
cd demo && npm install
```

### Development

```bash
# From project root - builds WASM and starts dev server
npm run dev

# OR run separately
npm run build:wasm    # Build Rust → WASM
npm run demo:dev      # Start Vite dev server

# OR from demo directory
cd demo
npm run dev
```

Visit `http://localhost:3000` to see the demos.

### Building for Production

```bash
# From project root - builds WASM + Vite bundle
npm run demo:build

# Preview the build
npm run demo:preview
```

## 📦 Deploying to Vercel

### Option 1: Deploy from GitHub (Recommended)

1. Push this repository to GitHub
2. Go to [Vercel](https://vercel.com) and import your repository
3. Set the **Root Directory** to `demo`
4. Vercel will auto-detect the Vite framework
5. Click "Deploy"

### Option 2: Deploy via CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy from the demo directory
cd demo
vercel
```

### Build Configuration

**Recommended**: Pre-build the WASM locally and commit the `pkg/` folder to your repository. Vercel doesn't have Rust/wasm-pack by default.

```bash
# Build WASM locally
npm run build:wasm

# Commit pkg folder
git add pkg/
git commit -m "Add pre-built WASM"
```

The build process:

1. **WASM**: Compiles Rust → WASM using `wasm-pack` (outputs to `../pkg`)
2. **Demo**: Bundles TypeScript + WASM with Vite (outputs to `./dist`)

For deployment, either pre-build the `pkg/` folder or set up Rust in your CI/CD.

## 📁 Project Structure

```
demo/
├── src/
│   ├── basic/          # Basic NSGA-II demo
│   ├── landuse/        # Land use allocation demo
│   ├── threejs/        # Three.js integration demo
│   ├── types/          # TypeScript types
│   └── visualization.ts # Plotly chart utilities
├── styles/
│   └── styles.css      # Shared styles
├── index.html          # Basic demo page
├── landuse.html        # Land use demo page
├── threejs.html        # Three.js demo page
├── package.json        # Dependencies and scripts
├── vite.config.ts      # Vite configuration
├── tsconfig.json       # TypeScript configuration
└── vercel.json         # Vercel deployment config
```

## 🎮 Available Demos

### 1. Basic NSGA-II (`index.html`)

Simple multi-objective optimization with linear objectives.

### 2. Land Use Allocation (`landuse.html`)

Optimize area allocation for different land uses (restaurant, residential, retail) to minimize overcrowding and underutilization.

### 3. Three.js Integration (`threejs.html`)

Complex optimization with custom evaluation functions, demonstrating integration with Three.js scene objects.

## 🔧 Key Features

- **Parallel Optimization**: Island model with migration across Web Workers
- **Real-time Visualization**: Live progress charts and Pareto front updates
- **Custom Evaluation**: Support for non-linear, user-defined objective functions
- **Auto-scaling**: Automatically detects CPU cores for optimal parallelization

## 📝 License

MIT
