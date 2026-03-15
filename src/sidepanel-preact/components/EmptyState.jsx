const HUMAN_EXAMPLES = [
  'Summarize my open Jira tickets',
  'Go to LinkedIn and draft a post about today\'s release',
  'Compare prices for flights to Tokyo next week',
];

const AGENT_EXAMPLES = [
  'Search for recent AI news',
  'Fill out this form with my details',
  'Find the best price for...',
];

export function EmptyState({ onSelectExample, primaryMode }) {
  const examples = primaryMode === 'agent' ? AGENT_EXAMPLES : HUMAN_EXAMPLES;

  return (
    <div class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>
      <h2>Hanzi in Chrome</h2>
      <p>Describe what you want to accomplish and the AI will browse autonomously to complete your task.</p>
      <div class="empty-examples">
        {examples.map((example, i) => (
          <button
            key={i}
            class="example-chip"
            onClick={() => onSelectExample(example)}
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
