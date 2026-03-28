defmodule FixtureSmokeTest do
  use ExUnit.Case, async: true

  test "fixture elixir compila e expõe D20.dados/0" do
    assert Code.ensure_loaded?(D20)
    assert function_exported?(D20, :dados, 0)
  end
end
