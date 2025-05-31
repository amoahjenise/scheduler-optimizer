export async function parseImageWithFastAPI(file: File, startDate: string, endDate: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('start_date', startDate)
  formData.append('end_date', endDate)

  const response = await fetch('http://localhost:8000/upload-schedule/', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Server Error: ${error}`)
  }

  const data = await response.json()

  if (data.error) {
    throw new Error(data.error)
  }

  return data // { dates: string[], grid: { nurse: string, shifts: string[] }[] }
}
