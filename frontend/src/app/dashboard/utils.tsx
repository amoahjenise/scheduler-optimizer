export function validateComments(comments: string): string[] {
    const errors: string[] = []
    const lines = comments.split('\n').filter(Boolean)
    lines.forEach((line, idx) => {
      const parts = line.split('|')
      if (parts.length < 2) {
        errors.push(`Line ${idx + 1} is malformed: missing nurse or date.`)
        return
      }
      const [nurse, date] = parts
      if (!nurse.trim()) errors.push(`Line ${idx + 1}: Nurse name is empty.`)
      if (!date.trim() || !isValidDate(date.trim()))
        errors.push(`Line ${idx + 1}: Date is invalid or empty.`)
    })
    return errors
  }
  
  function isValidDate(dateStr: string) {
    return !isNaN(Date.parse(dateStr))
  }
  