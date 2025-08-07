const sentences = [
  "The quick brown fox jumps over the lazy dog.",
  "React makes it painless to create interactive UIs.",
  "Tailwind CSS is a utility-first CSS framework.",
  "OpenAI develops powerful AI models.",
  "JavaScript is the language of the web.",
  "TypeScript adds types to JavaScript.",
  "Node.js allows JavaScript to run on the server.",
  "APIs connect different software systems.",
  "Responsive design adapts to any screen size.",
  "Git is a distributed version control system.",
  "VS Code is a popular code editor.",
  "Testing improves software reliability.",
  "Hooks simplify React component logic.",
  "Single Page Applications load fast.",
  "Accessibility is important for all users.",
  "Dark mode is popular among developers.",
  "Performance optimization matters.",
  "Microservices scale applications easily.",
  "Continuous integration speeds up delivery.",
  "Docker containers simplify deployment.",
  "GraphQL is a flexible API query language.",
  "REST APIs use HTTP methods.",
  "JWTs are used for authentication.",
  "Websockets enable real-time communication.",
  "Progressive Web Apps work offline."
];

export default function Dashboard() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[#ececec] px-6 py-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Inbox</h2>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {sentences.map((sentence, idx) => (
          <li
            key={idx}
            className="flex items-center px-6 py-3 border-b border-[#f5f5f5] text-[#2e2e30] hover:bg-[#f5f5f5] transition"
          >
            <span className="font-medium">{sentence}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}