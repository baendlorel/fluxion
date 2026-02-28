interface SectionProps {
  id: string;
  title: string;
  lead: string;
  children?: any;
}

export function Section(props: SectionProps) {
  return (
    <section id={props.id} class="doc-section">
      <header class="section-header">
        <h2 class="section-title">{props.title}</h2>
        <p class="section-lead">{props.lead}</p>
      </header>
      {props.children}
    </section>
  );
}
