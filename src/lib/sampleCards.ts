// Sample starter cards for Celina's practice, seeded on first run (empty board).
// 18 cards across content pillars. Titles/descriptions are realistic to the
// practice: EFT/EFCT, EFW, substance use, identity/LGBTQ+, neurodivergence,
// workshops, group offers, training milestones, professional education, and
// personal reflection.
export interface SampleCard {
  title: string;
  description: string;
  category: string;
  tags: string[];
  platforms: string[];
  content_pillar: string;
}

export const SAMPLE_CARDS: SampleCard[] = [
  // EFT / EFCT — 3
  {
    title: "The EFT cycle: naming your negative dance",
    description: "Introduce couples to the concept of the negative interaction cycle. Explain how partners get stuck in pursue-withdraw patterns and how naming the cycle is the first step toward change.",
    category: "EFT / EFCT",
    tags: ["eft", "couples", "psychoeducation"],
    platforms: ["Instagram", "Newsletter"],
    content_pillar: "EFT / EFCT",
  },
  {
    title: "Reach and hold: creating secure bonds",
    description: "A post on the EFT 'reach and hold' moment — how partners learn to turn toward each other for comfort. Highlight the shift from reactivity to responsiveness.",
    category: "EFT / EFCT",
    tags: ["eft", "attachment", "connection"],
    platforms: ["Instagram", "Facebook"],
    content_pillar: "EFT / EFCT",
  },
  {
    title: "EFCT for families: repairing ruptures",
    description: "Explore Emotionally Focused Family Therapy and how it helps parents and children rebuild trust after conflict. Frame around safety and accessibility.",
    category: "EFT / EFCT",
    tags: ["efct", "family", "repair"],
    platforms: ["Blog", "LinkedIn"],
    content_pillar: "EFT / EFCT",
  },
  // EFW — 2
  {
    title: "What is Emotionally Focused Individual Therapy (EFIT)?",
    description: "Introduce EFIT for individual clients. Explain how attachment-based individual work builds emotional balance and a stronger sense of self.",
    category: "EFW",
    tags: ["efit", "individual", "attachment"],
    platforms: ["Instagram", "Website"],
    content_pillar: "EFW",
  },
  {
    title: "Emotion as a compass, not a threat",
    description: "A reflective piece on how EFW reframes difficult emotions as meaningful signals. Offer a small practice for noticing and naming feelings.",
    category: "EFW",
    tags: ["emotion", "self-work", "practice"],
    platforms: ["Newsletter", "Blog"],
    content_pillar: "EFW",
  },
  // Substance Use — 2
  {
    title: "Attachment and substance use: the connection",
    description: "Discuss how unmet attachment needs can drive substance use, and how relational healing supports recovery. Compassion-forward, non-stigmatizing tone.",
    category: "Substance Use",
    tags: ["substance-use", "attachment", "recovery"],
    platforms: ["Blog", "LinkedIn"],
    content_pillar: "Substance Use",
  },
  {
    title: "Supporting a partner in recovery",
    description: "Practical, gentle guidance for couples navigating recovery together. Focus on boundaries, co-regulation, and rebuilding trust.",
    category: "Substance Use",
    tags: ["recovery", "couples", "boundaries"],
    platforms: ["Instagram", "Newsletter"],
    content_pillar: "Substance Use",
  },
  // Identity / LGBTQ+ — 2
  {
    title: "Affirming therapy for LGBTQ+ couples",
    description: "Highlight what affirming, identity-safe couples therapy looks like. Address minority stress and the strength of chosen family.",
    category: "Identity / LGBTQ+",
    tags: ["lgbtq", "affirming", "couples"],
    platforms: ["Instagram", "Website"],
    content_pillar: "Identity / LGBTQ+",
  },
  {
    title: "Holding space for identity exploration",
    description: "A supportive post on therapy as a safe space to explore gender and sexual identity without pressure or judgment.",
    category: "Identity / LGBTQ+",
    tags: ["identity", "safety", "exploration"],
    platforms: ["Instagram", "Facebook"],
    content_pillar: "Identity / LGBTQ+",
  },
  // Neurodivergence — 2
  {
    title: "Neurodivergent-affirming couples work",
    description: "Explore how therapy can honor neurodivergent communication styles in relationships. Move away from deficit framing toward mutual understanding.",
    category: "Neurodivergence",
    tags: ["neurodivergence", "adhd", "autism"],
    platforms: ["Blog", "Instagram"],
    content_pillar: "Neurodivergence",
  },
  {
    title: "Sensory needs and emotional connection",
    description: "A post on how honoring sensory and regulation needs supports deeper emotional connection for neurodivergent clients and their partners.",
    category: "Neurodivergence",
    tags: ["sensory", "regulation", "connection"],
    platforms: ["Instagram", "Newsletter"],
    content_pillar: "Neurodivergence",
  },
  // Workshops — 2
  {
    title: "Hold Me Tight® couples workshop",
    description: "Promote an upcoming Hold Me Tight weekend workshop for couples. Outline what to expect and who it's for.",
    category: "Workshops",
    tags: ["workshop", "hold-me-tight", "couples"],
    platforms: ["Instagram", "Facebook", "Newsletter"],
    content_pillar: "Workshops",
  },
  {
    title: "Emotional regulation skills workshop",
    description: "Announce a skills-based workshop on emotional regulation. Highlight take-home practices and a warm, small-group setting.",
    category: "Workshops",
    tags: ["workshop", "skills", "regulation"],
    platforms: ["Website", "Newsletter"],
    content_pillar: "Workshops",
  },
  // Group Offers — 1
  {
    title: "Attachment-focused support group launch",
    description: "Introduce a new ongoing support group grounded in attachment science. Describe the format, cadence, and how to join.",
    category: "Group Offers",
    tags: ["group", "support", "attachment"],
    platforms: ["Instagram", "Website"],
    content_pillar: "Group Offers",
  },
  // Training Milestones — 1
  {
    title: "Certified EFT Therapist milestone",
    description: "Share the milestone of completing ICEEFT certification. Reflect on the journey and what it means for client care.",
    category: "Training Milestones",
    tags: ["milestone", "certification", "iceeft"],
    platforms: ["LinkedIn", "Instagram"],
    content_pillar: "Training Milestones",
  },
  // Professional Education — 1
  {
    title: "Attending the EFT Summit: key takeaways",
    description: "A professional-audience post summarizing insights from a recent EFT conference. Position as continued-learning and thought leadership.",
    category: "Professional Education",
    tags: ["education", "conference", "eft"],
    platforms: ["LinkedIn", "Blog"],
    content_pillar: "Professional Education",
  },
  // Personal Reflection — 1
  {
    title: "Why I became a couples therapist",
    description: "A warm personal reflection on the path into relational therapy. Builds connection and trust with the audience.",
    category: "Personal Reflection",
    tags: ["reflection", "personal", "story"],
    platforms: ["Instagram", "Newsletter"],
    content_pillar: "Personal Reflection",
  },
  // Group Offers — 2nd (rounds the starter set to 18 cards)
  {
    title: "Couples connection circle: seasonal cohort",
    description: "Promote a seasonal small-group cohort for couples wanting to deepen connection between sessions. Warm, community-oriented framing.",
    category: "Group Offers",
    tags: ["group", "couples", "cohort"],
    platforms: ["Instagram", "Newsletter"],
    content_pillar: "Group Offers",
  },
];
