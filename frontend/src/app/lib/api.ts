// lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;

export async function parseImageWithFastAPI(file: File, startDate: string, endDate: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('start_date', startDate);
  formData.append('end_date', endDate);

  const response = await fetch(`${API_BASE}/schedules/upload-schedule/`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Server Error: ${error}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

export async function createScheduleAPI(
  screenshots: File[],
  startDate: string,
  endDate: string,
  notes: string,
  rules: string,
  autoComments: string,
  userId: string,
) {
  const formData = new FormData();

  function parseRulesInput(rulesText: string): Record<string, number | string> {
    const lines = rulesText.split('\n');
    const rulesObj: Record<string, number | string> = {};
  
    for (const line of lines) {
      const [key, value] = line.split('=').map((part) => part.trim());
      if (key && value !== undefined) {
        const numeric = Number(value);
        rulesObj[key] = isNaN(numeric) ? value : numeric;
      }
    }
  
    return rulesObj;
  }  

  function parseAutoComments(input: string) {
    const lines = input.trim().split('\n')
    const result: Record<string, Record<string, string>> = {}
  
    for (const line of lines) {
      if (!line.includes('|')) continue
      const [name, date, comment] = line.split('|').map(part => part.trim())
      if (!name || !date || !comment) continue
      if (!result[name]) result[name] = {}
      result[name][date] = comment
    }
  
    return result
  }  

  formData.append('period', `${startDate} to ${endDate}`);
  formData.append('user_id', userId);
  formData.append('notes', notes);
  formData.append('rules', JSON.stringify(parseRulesInput(rules)));
  formData.append('employee_comments', autoComments.trim() ? JSON.stringify(parseAutoComments(autoComments)) : '{}')

  screenshots.forEach((file) => {
    formData.append('raw_images', file);
  });

  const res = await fetch(`${API_BASE}/schedules/`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || res.statusText);
  }

  return await res.json();
}

export async function optimizeScheduleAPI(reqBody: {
    schedule_id: string | null;
    nurses: string[];
    dates: string[];
    assignments: Record<string, string[]>;
    comments: Record<string, Record<string, string>>;
    rules: Record<string, number>;
    notes: string;
  }) {
    const res = await fetch(`${API_BASE}/optimize/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reqBody),
    });
  
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || res.statusText);
    }
  
    return await res.json();
}  

// Fetch all system prompts (returns SystemPrompt[])
export async function fetchSystemPromptsAPI() {
  const res = await fetch(`${API_BASE}/system-prompt/`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to fetch system prompts');
  }
  return res.json(); // returns array of { id, name, content }
}

// Save a new system prompt with name and content
export async function saveSystemPromptAPI(name: string, content: string) {
  const res = await fetch(`${API_BASE}/system-prompt/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to save system prompt');
  }
  return res.json(); // returns the created SystemPrompt object
}

export async function getSystemPromptById(id: number) {
  const res = await fetch(`${API_BASE}/system-prompt/${id}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to fetch system prompt');
  }
  return res.json();
}

export async function resetSystemPromptAPI() {
  const response = await fetch(`${API_BASE}/system-prompt/reset/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error('Failed to reset system prompt');
  }
  const data = await response.json();
  return data; // assuming response returns { content: string } with the default prompt
}
