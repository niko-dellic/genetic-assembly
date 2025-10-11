// Main TypeScript file for the demo
let worker: Worker | null = null;

interface OptimizationSpec {
  algorithm: string;
  num_vars: number;
  population_size: number;
  num_iterations: number;
  crossover_rate: number;
  mutation_rate: number;
  num_offsprings: number;
  objectives: number[][];
}

interface OptimizationResult {
  pareto: number[][];
  stats: {
    iterations: number;
    population_size: number;
    pareto_size: number;
  };
  executionTime?: number;
}

function initWorker() {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

  worker.onmessage = (e) => {
    const { type, result, error } = e.data;

    if (type === 'INIT_SUCCESS') {
      console.log('Worker initialized successfully');
      return;
    }

    if (type === 'SOLVE_SUCCESS') {
      displayResults(result);
      enableButton();
      return;
    }

    if (type === 'ERROR') {
      showError(error);
      enableButton();
      return;
    }
  };

  worker.onerror = (error) => {
    showError(`Worker error: ${error.message}`);
    enableButton();
  };

  // Initialize the worker
  worker.postMessage({ type: 'INIT' });
}

function disableButton() {
  const btn = document.getElementById('runBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Running...';
}

function enableButton() {
  const btn = document.getElementById('runBtn') as HTMLButtonElement;
  btn.disabled = false;
  btn.textContent = 'Run Optimization';
}

function showStatus(message: string, className: string) {
  const results = document.getElementById('results')!;
  const status = document.getElementById('status')!;
  
  results.style.display = 'block';
  status.className = `status ${className}`;
  status.textContent = message;
}

function showError(message: string) {
  showStatus(message, 'error');
}

function displayResults(result: OptimizationResult) {
  showStatus('Optimization completed successfully!', 'success');

  // Display stats
  const statsDiv = document.getElementById('stats')!;
  statsDiv.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${result.stats.iterations}</div>
      <div class="stat-label">Generations</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${result.stats.population_size}</div>
      <div class="stat-label">Population Size</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${result.stats.pareto_size}</div>
      <div class="stat-label">Pareto Front Size</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${result.executionTime}ms</div>
      <div class="stat-label">Execution Time</div>
    </div>
  `;

  // Display pareto front
  const paretoOutput = document.getElementById('paretoOutput')!;
  paretoOutput.textContent = JSON.stringify(result.pareto, null, 2);
}

(window as any).runOptimization = () => {
  if (!worker) {
    showError('Worker not initialized');
    return;
  }

  disableButton();
  showStatus('Running optimization...', 'info');

  const algorithm = (document.getElementById('algorithm') as HTMLSelectElement).value;
  const numVars = parseInt((document.getElementById('numVars') as HTMLInputElement).value);
  const popSize = parseInt((document.getElementById('popSize') as HTMLInputElement).value);
  const generations = parseInt((document.getElementById('generations') as HTMLInputElement).value);
  const crossoverRate = parseFloat((document.getElementById('crossoverRate') as HTMLInputElement).value);
  const mutationRate = parseFloat((document.getElementById('mutationRate') as HTMLInputElement).value);

  // Create a simple multi-objective problem: knapsack-like
  // Objective 1: maximize value (minimize -value)
  // Objective 2: minimize weight
  const objectives: number[][] = [];
  
  // First objective: random values (we minimize, so negative for max)
  const obj1 = Array.from({ length: numVars }, () => -Math.random() * 10);
  objectives.push(obj1);
  
  // Second objective: random weights (minimize)
  const obj2 = Array.from({ length: numVars }, () => Math.random() * 5);
  objectives.push(obj2);

  const spec: OptimizationSpec = {
    algorithm,
    num_vars: numVars,
    population_size: popSize,
    num_iterations: generations,
    crossover_rate: crossoverRate,
    mutation_rate: mutationRate,
    num_offsprings: Math.floor(popSize * 0.5),
    objectives,
  };

  worker.postMessage({ type: 'SOLVE', payload: spec });
};

// Initialize worker on page load
initWorker();
