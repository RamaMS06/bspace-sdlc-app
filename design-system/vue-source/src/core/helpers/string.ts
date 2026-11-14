export const capitalizeFirstLetter = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export const snakeToCamel = (str: string) => {
  return str.replace(/([-_]\w)/g, g => g[1].toUpperCase())
}

export const snakeToPascal = (str: string) => {
  const camelCase = snakeToCamel(str)
  const pascalCase = camelCase[0].toUpperCase() + camelCase.substr(1)

  return pascalCase
}

export const camelToSnake = (str: string) => {
  let outputStr = str.charAt(0).toLowerCase() + str.slice(1)
  outputStr = outputStr.replace(/[A-Z]/g, match => '_' + match.toLowerCase())
  return outputStr
}

export const pascalToSnake = (str: string) => {
  return str.replace(/[A-Z]/g, (match, index) =>
    index === 0 ? match.toLowerCase() : '_' + match.toLowerCase()
  )
}

export const normalToSnake = (str: string) => {
  return str.replace(/\s+/g, '_').toLowerCase()
}

export const kebabToSnake = (str: string) => {
  return str.replace(/-/g, '_').toLowerCase()
}
