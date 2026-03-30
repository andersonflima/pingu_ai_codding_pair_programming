def calcular_total(itens)
  itens.reduce(0) { |total, item| total + item }
end
